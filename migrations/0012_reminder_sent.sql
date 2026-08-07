-- Prevents the reminders cron from re-sending the same appointment reminder
-- every run: getTargetSlotLabel() only has hour-granularity, so the same
-- booking would otherwise match on every 10-minute tick for close to an hour.
ALTER TABLE consultation_bookings ADD COLUMN reminder_sent_at TEXT;
