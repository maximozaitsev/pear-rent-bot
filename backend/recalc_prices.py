"""Recalculate active hourly bookings: charge 'first hour' once per day per renter/chair,
cap at 6000 kopeks (60 BYN / 11h). Redistributes total across bookings in time order."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from app.core.db import SessionLocal
from app.models import Booking, BookingType, BookingStatus
from app.services.pricing import calculate_price
from app.services.schedule import localize_shop


def recalc():
    db = SessionLocal()
    try:
        rows = (
            db.query(Booking)
            .filter(
                Booking.booking_type == BookingType.hourly,
                Booking.status == BookingStatus.active,
            )
            .order_by(Booking.renter_id, Booking.chair_id, Booking.starts_at)
            .all()
        )

        groups = {}
        for b in rows:
            day = localize_shop(b.starts_at).date()
            key = (b.renter_id, b.chair_id, day)
            groups.setdefault(key, []).append(b)

        updated = 0
        for key, bookings in groups.items():
            cumulative_hours = 0
            prev_correct = 0
            for b in bookings:
                cumulative_hours += b.duration_hours
                correct_total = min(calculate_price(BookingType.hourly, cumulative_hours), 6000)
                new_price = correct_total - prev_correct
                if b.price_amount != new_price:
                    b.price_amount = new_price
                    updated += 1
                prev_correct = correct_total

        db.commit()
        print(f"Recalculated {updated} booking(s) across {len(groups)} group(s).")
    finally:
        db.close()


if __name__ == "__main__":
    recalc()
