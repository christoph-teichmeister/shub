// Small display formatters shared by views.

/** A timestamp in the viewer's own date and time format. */
export const when = (iso: string): string => new Date(iso).toLocaleString();
