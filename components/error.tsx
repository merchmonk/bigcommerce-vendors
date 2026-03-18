import { ErrorMessageProps, ErrorProps } from '../types';

const ErrorContent = ({ message }: Pick<ErrorProps, 'message'>) => (
    <>
        <h3 style={{ marginTop: 0 }}>Failed to load</h3>
        <div>{message}</div>
    </>
)

const ErrorMessage = ({ error, renderPanel = true }: ErrorMessageProps) => {
    if (!error) return null;

    if (renderPanel) {
        return (
            <div
                style={{
                    background: '#ffffff',
                    border: '1px solid #fecaca',
                    borderRadius: '12px',
                    padding: '24px',
                    color: '#991b1b',
                }}
            >
                <ErrorContent message={error.message} />
            </div>
        )
    }

    return <ErrorContent message={error.message} />
};

export default ErrorMessage;
