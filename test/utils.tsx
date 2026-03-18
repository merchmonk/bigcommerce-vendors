import { render as defaultRender, RenderOptions } from '@testing-library/react';
import React, { ReactElement } from 'react';

const customRender = (ui: ReactElement, options: RenderOptions = {}) => (
  defaultRender(ui, options)
);

export * from '@testing-library/react';

export { customRender as render };
