import { fireEvent, render, screen } from '@test/utils';
import Header from '@components/header';

const mockPush = jest.fn();
const mockPrefetch = jest.fn();
const mockUseSession = jest.fn();
const mockUseRouter = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('../../context/session', () => ({
  useSession: () => mockUseSession(),
}));

describe('Header', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({ context: 'store-context' });
    mockUseRouter.mockReturnValue({
      pathname: '/dashboard',
      prefetch: mockPrefetch,
      push: mockPush,
    });
  });

  test('preserves context when navigating to vendors', () => {
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'Vendors' }));

    expect(mockPush).toHaveBeenCalledWith('/vendors?context=store-context');
  });
});
