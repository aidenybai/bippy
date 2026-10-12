// oxlint-disable-next-line typescript/no-explicit-any -- an untyped prop, as in plain JavaScript.
type Untyped = any;

export const BookingRow = ({ booking, stays }: { booking: Untyped; stays: Untyped }) => (
  <p>
    {booking.guests.fullName} {booking.status.replace("-", " ")}{" "}
    {new Date(booking.startDate).getDay()}{" "}
    {stays.reduce((total: number, stay: Untyped) => total + stay.numNights, 0)}
  </p>
);

export const FormRow = ({ children }: { children: Untyped }) => (
  <label htmlFor={children.props.id}>{children}</label>
);
