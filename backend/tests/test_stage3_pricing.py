import pytest

from app.models import BookingType
from app.services.pricing import calculate_price


@pytest.mark.parametrize(
    ("booking_type", "hours", "expected_kopeks"),
    [
        (BookingType.hourly, 1, 1000),
        (BookingType.hourly, 2, 1500),
        (BookingType.hourly, 3, 2000),
        (BookingType.hourly, 4, 2500),
        (BookingType.hourly, 8, 4500),
        (BookingType.hourly, 11, 6000),
        (BookingType.hourly, 12, 6000),
        (BookingType.full_day, 13, 6000),
        ("hourly", 1, 1000),
        ("full_day", 1, 6000),
    ],
)
def test_calculate_price(booking_type, hours, expected_kopeks):
    assert calculate_price(booking_type, hours) == expected_kopeks


def test_two_separate_bookings_calculated_separately():
    assert calculate_price(BookingType.hourly, 2) + calculate_price(BookingType.hourly, 2) == 3000


def test_hourly_requires_positive_duration():
    with pytest.raises(ValueError):
        calculate_price(BookingType.hourly, 0)
