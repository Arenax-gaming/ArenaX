export class AuthApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'AuthApiError'
  }
}

interface FieldError {
  field: string
  message: string
}

export const REGISTER_ERROR_MAP: Record<string, FieldError> = {
  EMAIL_ALREADY_EXISTS: {
    field: 'email',
    message: 'An account with this email already exists.',
  },
  USERNAME_TAKEN: {
    field: 'username',
    message: 'That username is unavailable. Please choose a different one.',
  },
}
