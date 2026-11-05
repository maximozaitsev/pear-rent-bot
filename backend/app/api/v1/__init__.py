from fastapi import APIRouter

from app.api.v1 import admin_schedule, auth, bookings, chairs, invitations, renters, schedule

router = APIRouter()
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(invitations.router, prefix="/admin/invitations", tags=["admin-invitations"])
router.include_router(schedule.router, tags=["schedule"])
router.include_router(chairs.router, tags=["chairs"])
router.include_router(bookings.router, tags=["bookings"])
router.include_router(renters.router, tags=["admin-renters"])
router.include_router(admin_schedule.router, tags=["admin-schedule"])

