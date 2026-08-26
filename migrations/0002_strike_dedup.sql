-- One strike per (run, date, reason, subject). `ref_id` is the goal_id for
-- 'missed_goal' and the food_log id for 'banned_food', so no legitimate
-- duplicate exists for either reason.
--
-- This lets catchUpGrading append strikes BEFORE claiming the day. A crash
-- between the two then leaves the day unlocked, so the next pass simply
-- redoes it; previously the claim committed first and a crash before the
-- append erased that day's strikes permanently, since listUnlockedDays
-- never revisits a locked day.
CREATE UNIQUE INDEX strikes_dedup ON strikes(run_id, date, reason, ref_id);
