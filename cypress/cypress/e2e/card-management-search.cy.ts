describe('Card management', () => {
  beforeEach(() => {
    cy.apiRegister().then(({ email }) => cy.uiLogin(email));
  });

  it('CY-CARD-01 adds a card from search', () => {
    cy.visit('/wallet');
    cy.contains('button', '+ Add card').click();
    cy.get('#card-search').type('Contoso Gold');
    cy.get('[aria-label="Add Contoso Gold"]').click();
    cy.get('[data-testid=wallet-card]').should('have.length', 1).and('contain', 'Contoso Gold');
  });

  it('CY-CARD-02 edits status to closed and the card leaves recommendations', () => {
    cy.visit('/wallet');
    cy.contains('button', '+ Add card').click();
    cy.get('#card-search').type('Double Cash');
    cy.get('[aria-label="Add Fabrikam Double Cash"]').click();
    cy.get('[data-testid=wallet-card]').contains('button', 'Edit').click();
    cy.get('[data-testid=wallet-card] select[id^=status-]').select('CLOSED'); // the Owner dropdown is a select too
    cy.get('[data-testid=wallet-card]').contains('button', 'Save').click();
    cy.get('[data-testid=wallet-card]').should('contain', 'closed');
    cy.visit('/categories/dining');
    cy.contains(/no approved cards/i).should('be.visible');
  });

  it('CY-CARD-03 validates last four digits', () => {
    cy.visit('/wallet');
    cy.contains('button', '+ Add card').click();
    cy.get('#last-four').type('12');
    cy.contains('[role=alert]', 'last 4').should('be.visible');
  });
});

describe('Search', () => {
  beforeEach(() => {
    cy.apiRegister().then(({ email }) => cy.uiLogin(email));
  });

  it('CY-SRCH-01 card search filters results', () => {
    cy.visit('/wallet');
    cy.contains('button', '+ Add card').click();
    cy.get('#card-search').type('Voyager');
    cy.get('[data-testid=card-search-results] li').should('have.length', 2).each(($li) => expect($li.text()).to.contain('Voyager'));
  });

  it('CY-SRCH-02 card search with no matches shows an empty state', () => {
    cy.visit('/wallet');
    cy.contains('button', '+ Add card').click();
    cy.get('#card-search').type('zzzz-no-card');
    cy.contains(/no cards match/i).should('be.visible');
  });

  it('CY-SRCH-03 merchant search by name and by domain', () => {
    cy.visit('/merchants');
    cy.get('#merchant-search').type('Bean');
    cy.get('[data-testid=merchant-results]').should('contain', 'Bean Street Coffee');
    cy.get('#merchant-search').clear().type('shopnow.example');
    cy.get('[data-testid=merchant-results]').should('contain', 'ShopNow');
  });

  it('CY-SRCH-04 public catalog API paginates and validates', () => {
    cy.request('/api/v1/cards?pageSize=3').its('body.items').should('have.length', 3);
    cy.request({ url: '/api/v1/cards?pageSize=500', failOnStatusCode: false }).its('status').should('eq', 400);
  });
});
