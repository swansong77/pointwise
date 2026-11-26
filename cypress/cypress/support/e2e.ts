/// <reference types="cypress" />

export const PASSWORD = 'cy-password-123';
export const uniqueEmail = (tag = 'cy') => `${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@cy.test`;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      apiRegister(email?: string): Chainable<{ email: string; token: string }>;
      apiAddCard(token: string, slug: string): Chainable<{ id: string }>;
      apiLogin(email: string, password: string): Chainable<string>;
      uiLogin(email: string, password?: string): Chainable<void>;
    }
  }
}

Cypress.Commands.add('apiRegister', (email = uniqueEmail()) =>
  cy.request('POST', '/api/v1/auth/register', { email, password: PASSWORD, name: 'Cy User' }).then((res) => ({ email, token: res.body.accessToken as string })),
);

Cypress.Commands.add('apiLogin', (email: string, password: string) =>
  cy.request('POST', '/api/v1/auth/login', { email, password }).then((res) => res.body.accessToken as string),
);

Cypress.Commands.add('apiAddCard', (token: string, slug: string) =>
  cy.request(`/api/v1/cards/${slug}`).then((card) =>
    cy
      .request({ method: 'POST', url: '/api/v1/wallet/cards', headers: { Authorization: `Bearer ${token}` }, body: { cardId: card.body.id, approvedAt: '2026-01-10' } })
      .then((res) => res.body as { id: string }),
  ),
);

Cypress.Commands.add('uiLogin', (email: string, password = PASSWORD) => {
  cy.visit('/login');
  cy.get('#email').type(email);
  cy.get('#password').type(password, { log: false });
  cy.get('[data-testid=login-submit]').click();
  cy.location('pathname').should('eq', '/dashboard');
});
