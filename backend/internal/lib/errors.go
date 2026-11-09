package lib

import "errors"

type Error struct {
	Status        int
	Code, Message string
}

func (e *Error) Error() string      { return e.Message }
func Invalid(message string) error  { return &Error{400, "VALIDATION_ERROR", message} }
func Forbidden() error              { return &Error{403, "FORBIDDEN", "Access denied"} }
func Conflict(message string) error { return &Error{409, "CONFLICT", message} }

var NotFound = &Error{404, "NOT_FOUND", "Record not found"}
var Unauthorized = &Error{401, "UNAUTHORIZED", "Authentication required or invalid"}

func IsNotFound(err error) bool { return errors.Is(err, NotFound) }
