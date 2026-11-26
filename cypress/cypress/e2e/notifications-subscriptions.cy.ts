describe('Notifications', () => {
  it('CY-NOT-01 job-generated notification appears and can be marked read', () => {
    cy.apiRegister().then(({ email, token }) => {
      cy.apiAddCard(token, 'contoso-gold').then((wc) => {
        cy.request({ url: '/api/v1/offers/eligible', headers: { Authorization: `Bearer ${token}` } }).then((res) => {
          const fresh = res.body.find((e: { offer: { title: string } }) => e.offer.title.startsWith('FreshCart'));
          cy.request({ method: 'POST', url: '/api/v1/offers/mine', headers: { Authorization: `Bearer ${token}` }, body: { offerId: fresh.offer.id, walletCardId: wc.id } });
        });
      });
      cy.apiLogin('admin@pointwise.local', 'Admin12345!').then((admin) =>
        cy.request({ method: 'POST', url: '/api/v1/admin/jobs/scan-expiring-offers/run', headers: { Authorization: `Bearer ${admin}` } }),
      );
      cy.uiLogin(email);
      cy.get('[data-testid=unread-badge]').should('be.visible');
      cy.visit('/notifications');
      cy.get('[data-testid=notification]').should('contain', 'Offer expiring');
      cy.get('[data-testid=read-all]').click();
      cy.get('[data-testid=unread-badge]').should('not.exist');
    });
  });

  it('CY-NOT-02 preferences reject an out-of-range value via API', () => {
    cy.apiRegister().then(({ token }) => {
      cy.request({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: { Authorization: `Bearer ${token}` }, body: { expiringDays: 999 }, failOnStatusCode: false })
        .its('status')
        .should('eq', 400);
    });
  });
});

describe('Subscriptions', () => {
  beforeEach(() => {
    cy.apiRegister().then(({ email }) => cy.uiLogin(email));
  });

  it('CY-SUB-01 free user sees plans and upgrades to lifetime', () => {
    cy.visit('/settings');
    cy.get('[data-testid=subscription]').should('contain', 'FREE');
    cy.get('[data-testid=plan-lifetime]').click();
    cy.get('[data-testid=subscription]').should('contain', 'PRO').and('contain', 'lifetime');
    cy.get('[data-testid=cancel-subscription]').should('not.exist');
  });

  it('CY-SUB-02 monthly upgrade can be canceled and resumed', () => {
    cy.visit('/settings');
    cy.get('[data-testid=plan-month]').click();
    cy.get('[data-testid=cancel-subscription]').click();
    cy.get('[data-testid=subscription]').should('contain', 'canceled');
    cy.contains('button', 'Resume subscription').click();
    cy.get('[data-testid=subscription]').should('contain', 'active');
  });
});
