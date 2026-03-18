import { useRouter } from 'next/router';
import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { bigCommerceSDK } from '../scripts/bcSdk';

const SessionContext = createContext({ context: '' });

const SessionProvider = ({ children }: { children: ReactNode }) => {
    const { query } = useRouter();
    const context = typeof query.context === 'string'
      ? query.context
      : Array.isArray(query.context)
        ? query.context[0] ?? ''
        : '';

    useEffect(() => {
        if (context) {
            // Keeps app in sync with BC (e.g. heatbeat, user logout, etc)
            bigCommerceSDK(context);
        }
    }, [context]);

    return (
        <SessionContext.Provider value={{ context }}>
            {children}
        </SessionContext.Provider>
    );
};

export const useSession = () => useContext(SessionContext);

export default SessionProvider;
