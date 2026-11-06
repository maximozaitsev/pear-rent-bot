export type Role = "admin" | "renter";

export interface User {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
  needs_registration: boolean;
}

export interface WorkingHours {
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  source?: string;
}

export interface Interval {
  starts_at: string;
  ends_at: string;
}

export interface DayBooking {
  id: string;
  starts_at: string;
  ends_at: string;
  booking_type: "hourly" | "full_day";
  duration_hours: number;
  price_amount?: number;
  currency?: string;
  payment_status?: string;
  status?: string;
  is_mine?: boolean;
  renter?: {
    id: string;
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
  };
}

export interface ChairDay {
  chair_id: string;
  name: string;
  is_fully_booked: boolean;
  is_partially_booked: boolean;
  is_free_whole_day: boolean;
  can_book_full_day?: boolean;
  busy_intervals: Interval[];
  free_intervals: Interval[];
  bookings: DayBooking[];
}

export interface DaySchedule {
  date: string;
  working_hours: WorkingHours;
  chairs: ChairDay[];
}

export interface WeekSchedule {
  week_start: string;
  days: DaySchedule[];
}

export interface AvailabilitySchedule {
  from: string;
  to: string;
  days: DaySchedule[];
}

export interface Booking {
  id: string;
  chair_id: string;
  renter_id: string;
  starts_at: string;
  ends_at: string;
  booking_type: "hourly" | "full_day";
  duration_hours: number;
  price_amount: number;
  currency: string;
  status: string;
  payment_status?: string | null;
  created_at?: string | null;
  renter?: DayBooking["renter"];
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
}

export interface Chair {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  archived_at: string | null;
}

export interface Renter {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface RenterPaymentStats {
  debt: number;
  to_pay: number;
  paid_total: number;
}

export interface Invitation {
  id: string;
  status: string;
  created_by: string;
  used_by: string | null;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
  invite_token?: string;
  invite_link?: string;
}

export interface WeeklyScheduleItem {
  weekday: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  updated_at?: string;
}

export interface DateOverride {
  date: string;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ConflictDetail {
  message?: string;
  conflicts?: Array<{ id: string; starts_at?: string; ends_at?: string; chair_id?: string; renter_id?: string }>;
}
