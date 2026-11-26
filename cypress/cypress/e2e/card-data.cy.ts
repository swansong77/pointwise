/** Phase C: public card knowledge APIs and the admin-only refresh API. */
describe('Card knowledge base', () => {
  it('CY-CD-01 public offer history, welcome bonuses and annual fees', () => {
    cy.request('/api/v1/cards/contoso-gold/offer-history').its('body.timeline').should('match', /^40K → 50K → /);
    cy.request('/api/v1/welcome-bonuses').its('body').should('have.length.greaterThan', 5);
    cy.request('/api/v1/annual-fees').then((r) => {
      const gold = r.body.find((f: { slug: string }) => f.slug === 'contoso-gold');
      expect(gold.annualFeeCents).to.be.a('number');
    });
  });

  it('CY-CD-02 card sources must be allow-listed issuer pages; non-admins are refused', () => {
    cy.apiLogin('admin@pointwise.local', 'Admin12345!').then((admin) => {
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request({ method: 'POST', url: '/api/v1/admin/card-sources', headers: { Authorization: `Bearer ${admin}` }, body: { cardId: card.body.id, url: 'https://cardpointers.com/cards/x' }, failOnStatusCode: false })
          .its('status')
          .should('eq', 400);
      });
    });
    cy.apiRegister().then(({ token }) => {
      cy.request({ url: '/api/v1/admin/card-sources', headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }).its('status').should('eq', 403);
    });
  });
});
