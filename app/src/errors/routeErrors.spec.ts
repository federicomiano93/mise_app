import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ErrorInfo } from 'react';
import { onRouteError } from './routeErrors';

const where = { location: {} as never, params: {}, pattern: '/orders' };

let logged: MockInstance;

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
});

describe('onRouteError', () => {
  it('logs nothing for a render error: React has already logged it, with its errorInfo', () => {
    const errorInfo: ErrorInfo = { componentStack: '\n    at Broken' };
    onRouteError(new Error('broken'), { ...where, errorInfo });
    expect(logged).not.toHaveBeenCalled();
  });

  it('logs an error that is not a render error (a loader, an action) once, so it is not lost', () => {
    const failure = new Error('the loader failed');
    onRouteError(failure, where);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith('Route failed:', failure);
  });

  it('copes with no details at all', () => {
    const failure = new Error('no details');
    onRouteError(failure, undefined as never);
    expect(logged).toHaveBeenCalledWith('Route failed:', failure);
  });
});
