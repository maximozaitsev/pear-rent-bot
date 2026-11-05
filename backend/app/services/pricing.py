from app.models import BookingType


def calculate_price(booking_type: BookingType | str, duration_hours: int) -> int:
    """Return booking price in kopeks (integer). Frontend must never supply trusted price."""
    btype = BookingType(booking_type) if isinstance(booking_type, str) else booking_type
    if btype == BookingType.full_day:
        return 6000
    if duration_hours < 1:
        raise ValueError("Duration must be at least one hour")
    return 1000 + 500 * (duration_hours - 1)
