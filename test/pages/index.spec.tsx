import Index from '@pages/index';
import { render } from '@test/utils';

const mockReplace = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

describe('Index page', () => {
  test('redirects users to vendors', () => {
    render(<Index />);
    expect(mockReplace).toHaveBeenCalledWith('/vendors');
  });
});
