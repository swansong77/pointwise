import { PASSWORD, uniqueEmail } from '../support/e2e';

describe('Authentication', () => {
  it('CY-AUTH-01 signs up and reaches the wallet', () => {
    cy.visit('/signup');
    cy.get('#name').type('Cy');
    cy.get('#email').type(uniqueEmail('signup'));
    cy.get('#password').type(PASSWORD);
    cy.get('[data-testid=signup-submit]').click();
    cy.location('pathname').should('eq', '/wallet');
  });

  it('CY-AUTH-02 rejects bad credentials with a generic message', () => {
    cy.apiRegister().then(({ email }) => {
      cy.visit('/login');
      cy.get('#email').type(email);
      cy.get('#password').type('not-the-password-1');
      cy.get('[data-testid=login-submit]').click();
      cy.contains('[role=alert]', 'Invalid email or password').should('be.visible');
    });
  });

  it('CY-AUTH-03 redirects anonymous users to login with callback', () => {
    cy.visit('/dashboard');
    cy.location('pathname').should('eq', '/login');
    cy.location('search').should('contain', 'callbackUrl');
  });

  it('CY-AUTH-04 signs out', () => {
    cy.apiRegister().then(({ email }) => {
      cy.uiLogin(email);
      cy.get('[data-testid=sign-out]').click();
      cy.location('pathname').should('eq', '/login');
    });
  });

  it('CY-AUTH-05 API rejects unauthenticated access', () => {
    cy.request({ url: '/api/v1/wallet/cards', failOnStatusCode: false }).its('status').should('eq', 401);
  });
});
