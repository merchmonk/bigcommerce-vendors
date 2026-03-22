import type { AppProps } from 'next/app';
import Header from '../components/header';
import SessionProvider from '../context/session';

const MyApp = ({ Component, pageProps }: AppProps) => {
    return (
        <SessionProvider>
            <>
                <div
                    style={{
                        margin: '0 auto',
                        maxWidth: '1100px',
                        padding: '24px',
                        fontFamily: 'Arial, sans-serif',
                        color: '#1f2937',
                    }}
                >
                    <Header />
                    <Component {...pageProps} />
                </div>
                <style jsx global>{`
                    * {
                        box-sizing: border-box;
                    }

                    body {
                        margin: 0;
                        background: #f8fafc;
                    }

                    button,
                    input,
                    select,
                    textarea {
                        font: inherit;
                    }

                    a {
                        color: inherit;
                    }
                `}</style>
            </>
        </SessionProvider>
    );
};

export default MyApp;
