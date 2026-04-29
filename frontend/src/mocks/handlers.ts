import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/user', () => {
    return HttpResponse.json({
      id: '1',
      username: 'testuser',
      email: 'test@example.com',
    })
  }),
  // Add more shared handlers here
]
