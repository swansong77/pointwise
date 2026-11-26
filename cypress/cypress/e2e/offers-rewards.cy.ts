describe('Offers', () => {
  beforeEach(() => {
    cy.apiRegister().then(({ email, token }) => {
      cy.apiAddCard(token, 'contoso-gold');
      cy.uiLogin(email);
    });
  });

  it('CY-OFF-01 adds an eligible offer to a card', () => {
    cy.visit('/offers');
    cy.get('[data-testid=eligible-offers]').contains('button', 'Add to card').first().click();
    cy.get('[data-testid=offer-row]').should('have.length.at.least', 1);
  });

  it('CY-OFF-02 redeems an offer and finds it under Redeemed', () => {
    cy.visit('/offers');
    cy.get('[aria-label^="Add offer FreshCart"]').click();
    cy.get('[data-testid=offer-row]').contains('FreshCart').parents('[data-testid=offer-row]').find('[data-testid=redeem]').click();
    cy.contains('[role=tab]', 'Redeemed').click();
    cy.get('[data-testid=offer-row]').should('contain', 'FreshCart');
  });

  it('CY-OFF-03 custom offer requires a card and a valid value', () => {
    cy.visit('/offers');
    cy.contains('button', '+ Custom offer').click();
    cy.get('#co-title').type('Local deal');
    cy.get('#co-value').type('abc');
    cy.contains('button', 'Save offer').should('be.disabled');
    cy.get('#co-card').select(1);
    cy.get('#co-value').clear().type('7.50');
    cy.contains('button', 'Save offer').click();
    cy.get('[data-testid=offer-row]').should('contain', 'Local deal').and('contain', '$7.50');
  });
});

describe('Rewards', () => {
  beforeEach(() => {
    cy.apiRegister().then(({ email, token }) => {
      cy.apiAddCard(token, 'contoso-gold');
      cy.apiAddCard(token, 'northwind-voyager');
      cy.uiLogin(email);
    });
  });

  it('CY-RWD-01 dashboard best card for dining is Contoso Gold at 5¢/$', () => {
    cy.get('[data-testid=best-by-category]').contains('a', 'Dining').should('contain', 'Contoso Gold').and('contain', '5¢/$');
  });

  it('CY-RWD-02 category page ranks Gold above Voyager for dining', () => {
    cy.visit('/categories/dining');
    cy.get('[data-testid=ranked-card]').eq(0).should('contain', 'Contoso Gold');
    cy.get('[data-testid=ranked-card]').eq(1).should('contain', 'Northwind Voyager').and('contain', '4.5¢/$');
  });

  it('CY-RWD-03 calculator returns totals', () => {
    cy.visit('/calculator');
    cy.get('[data-testid=calculate]').click();
    cy.get('[data-testid=net]').invoke('text').should('match', /\$/);
  });
});
