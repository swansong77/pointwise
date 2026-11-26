/** Portfolio revision: 5/24, households, benefits, imports, benefit alerts. */
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

const proUser = () =>
  cy.apiRegister().then((u) =>
    cy.request({ method: 'POST', url: '/api/v1/subscription/checkout', headers: auth(u.token), body: { interval: 'month' } }).then(() => u),
  );

describe('5/24 and household', () => {
  it('CY-524-01 family account shows each member’s count', () => {
    cy.uiLogin('family@pointwise.local', 'Family12345!');
    cy.visit('/five24');
    cy.get('[data-testid=five24-member]').should('have.length', 3);
    cy.contains('[data-testid=five24-member]', 'Jordan').find('[role=img][aria-label="5/24 status 5/24"]').should('exist');
    cy.contains('[data-testid=five24-member]', 'Riley').find('[role=img][aria-label="5/24 status 3/24"]').should('exist');
  });

  it('CY-524-02 a credit-report open date moves a card into the count', () => {
    proUser().then(({ email, token }) => {
      cy.request(`/api/v1/cards/contoso-gold`).then((card) =>
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id, lastFour: '31005' } }),
      );
      cy.uiLogin(email);
      cy.visit('/five24');
      cy.get('[role=img][aria-label="5/24 status 0/24"]').should('exist');
      cy.contains('[role=note]', 'no open date');
      const month = daysAgo(200).slice(0, 7);
      cy.get('#cr-name').type('Contoso Financial');
      cy.get('#cr-digits').type('31005');
      cy.get('#cr-opened').type(month);
      cy.contains('button', 'Add account').click();
      cy.contains('Matched:').should('be.visible');
      cy.contains('button', 'Use this date').click();
      cy.get('[role=img][aria-label="5/24 status 1/24"]').should('exist');
    });
  });

  it('CY-HH-01 a child member cannot hold a primary card (API) and household lists members', () => {
    proUser().then(({ email, token }) => {
      cy.request({ method: 'POST', url: '/api/v1/household/members', headers: auth(token), body: { nickname: 'Kid', relationship: 'CHILD' } }).then((kid) => {
        cy.request('/api/v1/cards/contoso-gold').then((card) => {
          cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id, profileId: kid.body.id }, failOnStatusCode: false })
            .its('status')
            .should('eq', 400);
          cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id, profileId: kid.body.id, cardholder: 'AUTHORIZED_USER' } });
        });
      });
      cy.uiLogin(email);
      cy.visit('/household');
      cy.get('[data-testid=household-member]').should('have.length', 2);
      cy.contains('[data-testid=household-member]', 'Kid').should('contain', 'Child').and('contain', 'AU');
    });
  });
});

describe('Benefits', () => {
  it('CY-BEN-01 logging more than the remaining value is refused', () => {
    proUser().then(({ email, token }) => {
      // a 4-year credit on a recently opened card is always in the "Available" bucket (date-independent)
      cy.request('/api/v1/cards/northwind-voyager-reserve').then((card) =>
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id, approvedAt: daysAgo(100) } }),
      );
      cy.uiLogin(email);
      cy.visit('/benefits');
      cy.contains('[data-testid=benefit-row]', 'Global Entry').within(() => {
        cy.contains('button', 'Log use').click();
        cy.get('input[inputmode=decimal]').type('200');
        cy.contains('button', 'Save').click();
        cy.contains('[role=alert]', 'left in this period');
      });
    });
  });

  it('CY-BEN-02 an expiring benefit produces a notification after the alert job runs', () => {
    proUser().then(({ email, token }) => {
      cy.request('/api/v1/cards/northwind-voyager').then((card) =>
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id, approvedAt: daysAgo(360) } }),
      );
      cy.apiLogin('admin@pointwise.local', 'Admin12345!').then((admin) =>
        cy.request({ method: 'POST', url: '/api/v1/admin/jobs/scan-benefit-expirations/run', headers: auth(admin) }),
      );
      cy.uiLogin(email);
      cy.visit('/notifications');
      cy.get('[data-testid=notification]').should('contain', 'Hotel credit expires in');
      cy.visit('/benefits');
      cy.contains('button', /Expiring \(1\)/).click();
      cy.contains('[data-testid=benefit-row]', 'Hotel credit').should('contain', 'Expiring soon');
    });
  });
});

describe('Import', () => {
  it('CY-IMP-01 CSV import with a full card number reports the row as an error and never stores it', () => {
    proUser().then(({ email }) => {
      cy.uiLogin(email);
      cy.intercept('GET', '**/api/v1/imports').as('history');
      cy.visit('/import');
      cy.wait('@history'); // the page is hydrated and signed in before the file is chosen (otherwise the selection can be lost)
      const csv = 'Card,Last 4,Issuer,Annual fee\nGood Card,4321,Example Bank,0\nBad Card,4111111111111111,Example Bank,0\n';
      cy.get('#import-file').selectFile({ contents: Cypress.Buffer.from(csv), fileName: 'cards.csv', mimeType: 'text/csv' });
      cy.contains('button', 'Preview import').click();
      cy.get('[data-testid=import-summary]').should('contain', 'New cards1').and('contain', 'Duplicates / errors1');
      cy.contains('[data-testid=import-row]', 'Bad Card').should('contain', 'full card number');
      cy.get('body').should('not.contain', '4111111111111111');
      cy.get('[data-testid=import-commit]').click();
      cy.get('[data-testid=import-done]').should('contain', 'Imported 1 cards');
    });
  });
});
