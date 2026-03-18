import useSWR from 'swr';
import { useSession } from '../context/session';
import { ErrorProps } from '../types';

async function fetcher(url: string, query: string) {
    const res = await fetch(`${url}?${query}`);

    if (!res.ok) {
        const { message } = await res.json();
        const error: ErrorProps = new Error(message || 'An error occurred while fetching the data.');
        error.status = res.status;
        throw error;
    }

    return res.json();
}

// Reusable SWR hooks for vendors app (product/order hooks removed)
// https://swr.vercel.app/
