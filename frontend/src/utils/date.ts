import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns';

/**
 * Formats a date to a standard string format.
 */
export const formatDate = (date: Date | string | number, formatStr: string = 'PPpp'): string => {
    const d = typeof date === 'string' ? parseISO(date) : new Date(date);
    if (!isValid(d)) return 'Invalid Date';
    return format(d, formatStr);
};

/**
 * Returns a relative time string (e.g., "2 hours ago").
 */
export const getRelativeTime = (date: Date | string | number): string => {
    const d = typeof date === 'string' ? parseISO(date) : new Date(date);
    if (!isValid(d)) return 'Invalid Date';
    return formatDistanceToNow(d, { addSuffix: true });
};
