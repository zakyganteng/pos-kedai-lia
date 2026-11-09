package daterange

import (
	"pos/internal/lib"
	"time"
)

// Parse validates and converts an inclusive [from, to] date string pair into UTC start (inclusive) and end (exclusive) boundaries.
func Parse(from, to string, zone *time.Location) (time.Time, time.Time, error) {
	start, err := time.ParseInLocation("2006-01-02", from, zone)
	if err != nil {
		return time.Time{}, time.Time{}, lib.Invalid("from must be ISO date")
	}
	end, err := time.ParseInLocation("2006-01-02", to, zone)
	if err != nil || end.Before(start) || end.After(start.AddDate(0, 0, 365)) {
		return time.Time{}, time.Time{}, lib.Invalid("Inclusive date range must be 1 to 366 days")
	}
	return start.UTC(), end.AddDate(0, 0, 1).UTC(), nil
}
