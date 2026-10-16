import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import BaseModel, Field

# backend/.env
load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(
    title="Aura Skincare Support API",
    description="Backend for Aria, the Aura Skincare AI voice agent.",
    version="1.1.0",
)

# Allow the local React/Vite frontend to call this API.

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "https://aura-voice-agent-alpha.vercel.app",
        "https://aura-voice-agent-51l1dpgv6-sumitpandeyji9-2462.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# mock order database.
ORDERS = {
    "ORD-101": {
        "order_id": "ORD-101",
        "customer": "Priya Sharma",
        "product": "Vitamin C Serum (30ml)",
        "value": 699,
        "currency": "INR",
        "status": "Out for Delivery",
        "carrier": "BlueDart",
        "tracking_number": "BD-982103",
        "delivery_note": "Expected by 6 PM today",
        "delivered_days_ago": None,
        "opened": None,
        "used": None,
    },
    "ORD-102": {
        "order_id": "ORD-102",
        "customer": "Rahul Verma",
        "product": "Hydrating Sunscreen SPF 50",
        "value": 499,
        "currency": "INR",
        "status": "Delivered",
        "carrier": "Delhivery",
        "tracking_number": "DL-441029",
        "delivery_note": "Delivered 14 days ago",
        "delivered_days_ago": 14,
        "opened": None,
        "used": None,
    },
    "ORD-103": {
        "order_id": "ORD-103",
        "customer": "Ananya Patel",
        "product": "Green Tea Face Wash + Toner",
        "value": 850,
        "currency": "INR",
        "status": "Processing",
        "carrier": None,
        "tracking_number": None,
        "delivery_note": "Ordered 3 hours ago",
        "delivered_days_ago": None,
        "opened": None,
        "used": None,
    },
}


# Request models for policy checks.
class ReturnCheckRequest(BaseModel):
    delivered_days_ago: int = Field(ge=0)
    unopened: bool
    unused: bool
    original_packaging: bool


class DamageCheckRequest(BaseModel):
    delivered_hours_ago: float = Field(ge=0)
    photos_available: bool


class ShippingCheckRequest(BaseModel):
    order_value: float = Field(ge=0)

    

class CODCheckRequest(BaseModel):
    order_value: float = Field(ge=0)
    payment_method: Literal["cash", "upi"] = "upi"


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


@app.get("/")
def root():
    return {
        "message": "Aura Skincare AI Voice Agent API",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "Aura Skincare Support API",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/orders")
def get_all_orders():
    return {"orders": list(ORDERS.values())}


# Required tool: get_order_details(order_id).
def get_order_details(order_id: str) -> dict:
    normalized_id = order_id.strip().upper()

    if not normalized_id:
        raise HTTPException(
            status_code=400,
            detail="Please provide an order ID.",
        )

    order = ORDERS.get(normalized_id)
    if order is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Order {normalized_id} was not found. "
                "Please verify the order ID."
            ),
        )

    # Return a copy so callers cannot modify the stored record.
    return dict(order)


@app.get("/orders/{order_id}")
def order_details_endpoint(order_id: str):
    return get_order_details(order_id)


# Cancellation is allowed only when the order is Processing.
@app.get("/orders/{order_id}/cancellation-eligibility")
def check_cancellation_eligibility(order_id: str):
    order = get_order_details(order_id)
    eligible = order["status"] == "Processing"

    return {
        "order_id": order["order_id"],
        "eligible": eligible,
        "resolution_status": "ELIGIBLE" if eligible else "NOT_ELIGIBLE",
        "message": (
            "This order is eligible for cancellation."
            if eligible
            else (
                "This order cannot be cancelled because its status "
                f"is {order['status']}. Orders can only be cancelled "
                "while Processing."
            )
        ),
        
    }
@app.post("/policy/cod")
def check_cod_policy(request: CODCheckRequest):
    eligible = request.order_value <= 2500

    return {
        "order_value": request.order_value,
        "eligible": eligible,
        "payment_method": request.payment_method,
        "currency": "INR",
        "available_methods": ["cash", "upi"] if eligible else [],
        "message": (
            "COD is available. Payment can be made by cash or UPI at the doorstep."
            if eligible
            else "COD is not available for orders above ₹2,500."
        ),
    }


@app.get("/policy")
def get_brand_policies():
    return {
        "brand": "Aura Skincare",
        "shipping": {
            "free_shipping_threshold": 499,
            "fee_below_threshold": 50,
            "standard_delivery": "3-5 business days",
        },
        "returns": {
            "window_days": 7,
            "conditions": ["Unopened", "Unused", "Original packaging"],
        },
        "damaged_products": {
            "report_within_hours": 48,
            "photos_required": True,
            "remedy": "Replacement, subject to review",
        },
        "cancellation": {
            "allowed_status": "Processing",
            "shipped_or_out_for_delivery": False,
        },
        "cod": {
            "maximum_order_value": 2500,
            "payment_methods": ["cash", "upi"],
        },
    }


@app.post("/chat")
def chat_with_groq(request: ChatRequest):
    """Generate a text response with Groq; browser APIs handle speech."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is missing from backend/.env",
        )

    message = request.message.strip()
    if not message:
        raise HTTPException(
            status_code=400,
            detail="Message cannot be empty.",
        )

    # Supply verified mock order and policy data as context, but do not claim
    # to perform actions such as actually cancelling or refunding an order.
    context = (
        f"Known sample orders: {ORDERS}. "
        "Aura Skincare policies: returns within 7 days only if unopened, "
        "unused, and in original packaging; damage must be reported within "
        "48 hours and photos are required; cancellation eligibility is only "
        "for orders whose status is Processing; standard delivery is 3-5 "
        "business days; shipping is free for order values of ₹499 or more, "
        "otherwise ₹50; COD is available for orders up to ₹2500 with cash or UPI. "
        "These are sample records and policies, not a live commerce system."
    )

    try:
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Aria, a friendly, concise customer-support "
                        "assistant for Aura Skincare. Answer skincare product "
                        "and customer-support questions in clear, natural "
                        "spoken language. Use the provided sample orders and "
                        "policies when relevant. Never invent order details, "
                        "medical claims, refunds, cancellations, or actions. "
                        "Do not claim an order was cancelled or a refund issued. "
                        "For personal medical concerns, avoid diagnosis and "
                        "recommend consulting a qualified clinician when appropriate. "
                        "If the information is not available, say so.\n\n"
                        + context
                    ),
                },
                {"role": "user", "content": message},
            ],
            temperature=0.3,
            max_tokens=300,
        )

        reply = completion.choices[0].message.content
        if not reply:
            raise HTTPException(
                status_code=502,
                detail="Groq returned an empty response. Please try again.",
            )

        return {"reply": reply.strip()}

    except HTTPException:
        raise

    except Exception as exc:
        # Log the technical error in the backend terminal.
        print(
            f"Groq chat error ({type(exc).__name__}): {exc}",
            flush=True,
        )

        # Return a safe message to the frontend.
        raise HTTPException(
            status_code=502,
            detail=(
                "Aria is temporarily unable to connect to the AI service. "
                "Please check your internet connection and try again."
            ),
        ) from None