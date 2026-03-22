import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useSession } from '../context/session';

export const TabIds = {
    DASHBOARD: 'dashboard',
    VENDORS: 'vendors',
    ORDERS: 'orders',
};

export const TabRoutes = {
    [TabIds.DASHBOARD]: '/dashboard',
    [TabIds.VENDORS]: '/vendors',
    [TabIds.ORDERS]: '/orders',
};

const Header = () => {
    const router = useRouter();
    const { pathname } = router;
    const { context } = useSession();
    const activeTab = pathname.startsWith('/vendors')
        ? TabIds.VENDORS
        : pathname.startsWith('/orders')
            ? TabIds.ORDERS
        : pathname.startsWith('/dashboard')
            ? TabIds.DASHBOARD
            : '';

    const withContext = (path: string) => (context ? `${path}?context=${encodeURIComponent(context)}` : path);

    useEffect(() => {
        void router.prefetch(withContext('/dashboard'));
        void router.prefetch(withContext('/vendors'));
        void router.prefetch(withContext('/orders'));
    }, [context, router]);

    const items = [
        { ariaControls: 'dashboard', id: TabIds.DASHBOARD, title: 'Dashboard' },
        { ariaControls: 'vendors', id: TabIds.VENDORS, title: 'Vendors' },
        { ariaControls: 'orders', id: TabIds.ORDERS, title: 'Orders' },
    ];

    const handleTabClick = (tabId: string) => {
        return router.push(withContext(TabRoutes[tabId]));
    };

    return (
        <div style={{ marginBottom: '32px' }}>
            <div
                style={{
                    display: 'flex',
                    gap: '12px',
                    borderBottom: '1px solid #d1d5db',
                    paddingBottom: '12px',
                }}
            >
                {items.map(item => {
                    const isActive = activeTab === item.id;

                    return (
                        <button
                            key={item.id}
                            type="button"
                            aria-controls={item.ariaControls}
                            aria-pressed={isActive}
                            onClick={() => handleTabClick(item.id)}
                            style={{
                                border: 'none',
                                borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
                                background: 'transparent',
                                color: isActive ? '#2563eb' : '#4b5563',
                                cursor: 'pointer',
                                fontSize: '16px',
                                fontWeight: 600,
                                padding: '8px 0',
                            }}
                        >
                            {item.title}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default Header;
