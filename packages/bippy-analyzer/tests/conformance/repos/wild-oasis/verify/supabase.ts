/**
 * Stands in for `@supabase/supabase-js`: a signed-in user and a few rows per table, enough
 * for pages to render with data. Writes succeed and change nothing, and a filter on a
 * missing value, like a route param the harness doesn't set, matches every row.
 */
type Row = Record<string, unknown>;

interface QueryResult {
  data: unknown;
  error: null;
  count: number;
}

const TODAY = new Date().toISOString().slice(0, 10);

export const USER = {
  id: "user-1",
  email: "ada@example.com",
  role: "authenticated",
  user_metadata: { fullName: "Ada Lovelace", avatar: "" },
};

const CABIN_BOOKINGS = [{ startDate: TODAY, endDate: TODAY, numNights: 2 }];

const GUESTS: Row[] = [
  {
    id: 1,
    fullName: "Grace Hopper",
    email: "grace@example.com",
    nationalID: "123",
    nationality: "United States",
    countryFlag: "",
    bookings: [{ id: 1, cabinId: 1, ...CABIN_BOOKINGS[0] }],
  },
  {
    id: 2,
    fullName: "Alan Turing",
    email: "alan@example.com",
    nationalID: "456",
    nationality: "United Kingdom",
    countryFlag: "",
    bookings: [],
  },
];

const CABINS: Row[] = [
  {
    id: 1,
    created_at: TODAY,
    name: "001",
    maxCapacity: 2,
    regularPrice: 250,
    discount: 0,
    description: "A small cabin",
    image: "",
    bookings: CABIN_BOOKINGS,
  },
  {
    id: 2,
    created_at: TODAY,
    name: "002",
    maxCapacity: 4,
    regularPrice: 400,
    discount: 50,
    description: "A large cabin",
    image: "",
    bookings: CABIN_BOOKINGS,
  },
];

const BOOKINGS: Row[] = [
  { status: "unconfirmed", isPaid: false, hasBreakfast: false },
  { status: "checked-in", isPaid: true, hasBreakfast: true },
].map((booking, index) => ({
  ...booking,
  id: index + 1,
  created_at: TODAY,
  startDate: TODAY,
  endDate: TODAY,
  numNights: 2,
  numGuests: 2,
  cabinPrice: 500,
  extrasPrice: booking.hasBreakfast ? 60 : 0,
  totalPrice: booking.hasBreakfast ? 560 : 500,
  observations: "",
  cabinId: CABINS[index]?.id,
  guestId: GUESTS[index]?.id,
  cabins: CABINS[index],
  guests: GUESTS[index],
}));

const SETTINGS: Row[] = [
  { id: 1, minBookingLength: 1, maxBookingLength: 30, maxGuestsPerBooking: 8, breakfastPrice: 15 },
];

const TABLES: Record<string, Row[]> = {
  bookings: BOOKINGS,
  cabins: CABINS,
  guests: GUESTS,
  settings: SETTINGS,
};

class Query implements PromiseLike<QueryResult> {
  readonly rows: Row[];

  constructor(rows: Row[]) {
    this.rows = rows;
  }

  select = (): Query => this;
  insert = (): Query => this;
  update = (): Query => this;
  upsert = (): Query => this;
  delete = (): Query => this;
  or = (): Query => this;
  order = (): Query => this;
  limit = (): Query => this;
  range = (): Query => this;
  gte = (): Query => this;
  lte = (): Query => this;

  eq = (field: string, value: unknown): Query =>
    value === undefined ? this : new Query(this.rows.filter((row) => row[field] === value));

  single = (): Promise<QueryResult> => this.#resolve(this.rows[0] ?? null);
  maybeSingle = (): Promise<QueryResult> => this.#resolve(this.rows[0] ?? null);

  // oxlint-disable-next-line unicorn/no-thenable -- Supabase queries run when awaited.
  then = <Result = QueryResult, Rejected = never>(
    onFulfilled?: ((result: QueryResult) => Result | PromiseLike<Result>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): Promise<Result | Rejected> => this.#resolve(this.rows).then(onFulfilled, onRejected);

  #resolve = (data: unknown): Promise<QueryResult> =>
    Promise.resolve({ data, error: null, count: this.rows.length });
}

const ok = <Data>(data: Data) => Promise.resolve({ data, error: null });

export const createClient = () => ({
  from: (table: string) => new Query(TABLES[table] ?? []),
  auth: {
    getSession: () => ok({ session: { user: USER } }),
    getUser: () => ok({ user: USER }),
    signInWithPassword: () => ok({ user: USER, session: { user: USER } }),
    signUp: () => ok({ user: USER, session: { user: USER } }),
    signOut: () => Promise.resolve({ error: null }),
    updateUser: () => ok({ user: USER }),
  },
  storage: {
    from: () => ({ upload: () => ok({ path: "" }) }),
  },
});
