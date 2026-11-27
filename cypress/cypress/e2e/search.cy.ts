/** Universal search API checks (synthetic data). */
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};

describe('Universal search API', () => {
  it('CY-SRCH-01 suggest and ask: understood, answered, follow-up, private to the caller', () => {
    const email = 'cy.search.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Search Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request('/api/v1/cards/contoso-gold').then((card) => {
        cy.request({ method: 'POST', url: '/api/v1/wallet/cards', headers: auth(token), body: { cardId: card.body.id } }).then((w) => {
          cy.request({ method: 'POST', url: '/api/v1/offers/intel/import', headers: auth(token), body: { walletCardId: w.body.id, text: 'Hilton: Spend $500, get $100 back, expires ' + us(10) } });
          cy.request({ url: '/api/v1/search/suggest?q=', headers: auth(token) }).its('body.suggestions').should('have.length.greaterThan', 5);
          cy.request({ url: '/api/v1/search/suggest?q=' + encodeURIComponent('Costco $1500'), headers: auth(token) }).then((r) => {
            expect(r.body.understood.intent).to.eq('SHOPPING');
            expect(r.body.suggestions[0].type).to.eq('QUERY');
          });
          cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(token), body: { q: 'What card should I use at Costco for $1,500?' } }).then((r) => {
            expect(r.body.answer.intent).to.eq('SHOPPING');
            expect(r.body.answer.summary).to.match(/Best:/);
            expect(r.body.answer.confidence).to.be.greaterThan(0);
            cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(token), body: { q: 'It will cost $2,000', slots: r.body.slots } }).then((f) => {
              expect(f.body.usedFollowUp).to.eq(true);
              expect(f.body.answer.understood).to.deep.include({ type: 'amount', label: '$2,000' });
            });
          });
          cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(token), body: { q: 'purple monkey' } }).its('body.answer.unanswered').should('eq', true);
          cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(token), body: { q: '' }, failOnStatusCode: false }).its('status').should('eq', 400);
        });
      });
    });
    const other = 'cy.search2.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email: other, password: 'e2e-password-1', name: 'Other' }).then((reg) => {
      cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(reg.body.accessToken), body: { q: 'Show all Hilton offers' } }).then((r) => {
        expect(r.body.answer.related.filter((x: { type: string }) => x.type === 'OFFER')).to.have.length(0);
      });
    });
    cy.request({ method: 'POST', url: '/api/v1/search/ask', body: { q: 'hello' }, failOnStatusCode: false }).its('status').should('eq', 401);
  });

  it('CY-SRCH-02 conversation memory, history, saved searches and the dashboard', () => {
    const email = 'cy.search3.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Memory Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(token), body: { q: 'What card should I use for a Hilton stay?' } }).then((first) => {
        expect(first.body.sessionId).to.match(/^[0-9a-f-]{36}$/);
        cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(token), body: { q: 'It will cost $2,500', sessionId: first.body.sessionId } }).then((second) => {
          expect(second.body.usedFollowUp).to.eq(true);
          expect(second.body.sessionId).to.eq(first.body.sessionId);
        });
      });
      cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(token), body: { q: 'Flight to Hawaii next month' } }).its('body.answer.warnings').should('satisfy', (w: string[]) => w.some((x) => /Assumed economy/.test(x)));
      cy.request({ method: 'POST', url: '/api/v1/search/saved', headers: auth(token), body: { query: 'Show all Hilton offers', name: 'Hilton' } }).then((saved) => {
        expect(saved.body).to.include({ kind: 'SAVED', name: 'Hilton' });
        cy.request({ url: '/api/v1/search/dashboard', headers: auth(token) }).then((d) => {
          expect(d.body.saved.map((x: { id: string }) => x.id)).to.include(saved.body.id);
          expect(d.body.recent.length).to.be.greaterThan(1);
          expect(d.body.totals.questions).to.be.greaterThan(1);
        });
        cy.request({ method: 'DELETE', url: '/api/v1/search/history', headers: auth(token) }).its('body.removed').should('be.greaterThan', 1);
        cy.request({ url: '/api/v1/search/saved', headers: auth(token) }).its('body').should('have.length', 1);
        cy.request({ method: 'DELETE', url: '/api/v1/search/entries/' + saved.body.id, headers: auth(token) }).its('status').should('eq', 204);
      });
    });
  });

  it('CY-SRCH-03 reminders: set, list, private, validated; answers offer only allow-listed actions', () => {
    const email = 'cy.search4.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Reminder Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      const due = new Date(Date.now() + 5 * 86_400_000).toISOString();
      cy.request({ method: 'POST', url: '/api/v1/reminders', headers: auth(token), body: { title: 'Use the Hilton credit', dueAt: due, link: '/offers/expirations' } }).then((r) => {
        expect(r.body.status).to.eq('PENDING');
        cy.request({ url: '/api/v1/reminders', headers: auth(token) }).its('body').should('have.length', 1);
        cy.request('POST', '/api/v1/auth/register', { email: 'cy.search5.' + Date.now() + '@e2e.test', password: 'e2e-password-1', name: 'Other' }).then((o) => {
          cy.request({ url: '/api/v1/reminders', headers: auth(o.body.accessToken) }).its('body').should('have.length', 0);
          cy.request({ method: 'DELETE', url: '/api/v1/reminders/' + r.body.id, headers: auth(o.body.accessToken), failOnStatusCode: false }).its('status').should('eq', 404);
        });
        cy.request({ method: 'DELETE', url: '/api/v1/reminders/' + r.body.id, headers: auth(token) }).its('status').should('eq', 204);
      });
      cy.request({ method: 'POST', url: '/api/v1/reminders', headers: auth(token), body: { title: 'x', dueAt: due, link: 'https://evil.test' }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ method: 'POST', url: '/api/v1/reminders', headers: auth(token), body: { title: 'x', dueAt: '2020-01-01T00:00:00Z' }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ method: 'POST', url: '/api/v1/search/ask', headers: auth(token), body: { q: 'Sync offers' } }).its('body.answer.calls').should('have.length', 0);
    });
  });

  it('CY-COP-01 AI Mode: settings, the plan, consent defaults, and isolation', () => {
    const email = 'cy.cop.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Copilot Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ url: '/api/v1/copilot/settings', headers: auth(token) }).then((s) => {
        expect(s.body).to.deep.include({ aiModeEnabled: false, mode: 'QUICK', responseStyle: 'BALANCED' });
        expect(s.body.cloudShare).to.deep.include({ consented: false });
        expect(s.body.modes).to.have.length(6);
      });
      cy.request({ method: 'PUT', url: '/api/v1/copilot/settings', headers: auth(token), body: { mode: 'NOPE' }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ method: 'PUT', url: '/api/v1/copilot/settings', headers: auth(token), body: { cloudProviders: ['No Such Provider'] }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ method: 'PUT', url: '/api/v1/copilot/settings', headers: auth(token), body: { aiModeEnabled: true, mode: 'TRAVEL', temperature: 0.2 } }).its('body.mode').should('eq', 'TRAVEL');
      cy.request({ method: 'POST', url: '/api/v1/copilot/ask', headers: auth(token), body: { q: 'What should I do today?' } }).then((r) => {
        expect(r.body.plan.kind).to.eq('AGENDA');
        expect(r.body.mode).to.eq('TRAVEL');
        expect(r.body.plan.lenses.length).to.be.greaterThan(0);
        expect(r.body.runId).to.match(/^[0-9a-f-]{36}$/);
      });
      cy.request({ url: '/api/v1/copilot/agenda?when=month', headers: auth(token) }).its('body.plan.kind').should('eq', 'AGENDA');
      cy.request({ url: '/api/v1/copilot/disclosures', headers: auth(token) }).its('body').should('be.an', 'array');
      cy.request({ method: 'POST', url: '/api/v1/copilot/ask', body: { q: 'hi' }, failOnStatusCode: false }).its('status').should('eq', 401);
    });
  });

  it('CY-COP-02 what-if, goals and memory over the API', () => {
    const email = 'cy.cop2.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Phase Two' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ method: 'POST', url: '/api/v1/copilot/ask', headers: auth(token), body: { q: 'What if I wait 3 months?' } }).then((r) => {
        expect(r.body.plan.kind).to.eq('WHATIF');
        expect(r.body.plan.whatIf).to.include({ scenario: 'WAIT', version: 'what-if/1' });
        expect(r.body.plan.whatIf.deltas.length).to.be.greaterThan(0);
        expect(r.body.plan.whatIf.assumptions.length).to.be.greaterThan(0);
      });
      cy.request({ method: 'POST', url: '/api/v1/copilot/ask', headers: auth(token), body: { q: 'What if I cancel it?' } }).its('body.plan.summary').should('match', /which card/);
      cy.request({ method: 'POST', url: '/api/v1/copilot/goals', headers: auth(token), body: { kind: 'FIVE24', title: 'Stay under 5/24', target: { max: 4 } } }).then((g) => {
        expect(g.body.progress.state).to.be.oneOf(['ON_TRACK', 'UNKNOWN']);
        cy.request({ method: 'PATCH', url: '/api/v1/copilot/goals/' + g.body.id, headers: auth(token), body: { status: 'DONE' } }).its('body.status').should('eq', 'DONE');
        cy.request({ method: 'DELETE', url: '/api/v1/copilot/goals/' + g.body.id, headers: auth(token) }).its('status').should('eq', 204);
      });
      cy.request({ method: 'POST', url: '/api/v1/copilot/goals', headers: auth(token), body: { kind: 'NOPE', title: 'x y' }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ method: 'PUT', url: '/api/v1/copilot/memory/preferences', headers: auth(token), body: { airlines: ['Delta'], priorities: ['TRAVEL'] } }).its('body.airlines').should('deep.equal', ['Delta']);
      cy.request({ method: 'PUT', url: '/api/v1/copilot/memory/preferences', headers: auth(token), body: { priorities: ['FUN'] }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ method: 'POST', url: '/api/v1/copilot/memory/decisions', headers: auth(token), body: { itemId: 'offer-exp:1', action: 'SNOOZE', days: 3 } }).its('status').should('eq', 201);
      cy.request({ method: 'POST', url: '/api/v1/copilot/memory/decisions', headers: auth(token), body: { itemId: 'offer-exp:1', action: 'SNOOZE', days: 0 }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ url: '/api/v1/copilot/memory', headers: auth(token) }).its('body').should('have.length.greaterThan', 1);
      cy.request({ method: 'DELETE', url: '/api/v1/copilot/memory', headers: auth(token) }).its('body.removed').should('be.greaterThan', 1);
    });
  });

  it('CY-COP-03 dashboard, briefings and alerts over the API', () => {
    const email = 'cy.cop3.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Phase Three' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ url: '/api/v1/copilot/dashboard', headers: auth(token) }).then((d) => {
        for (const k of ['today', 'expiring', 'actions', 'travel', 'savings', 'household', 'portfolio', 'goals', 'recommendations']) expect(d.body).to.have.property(k);
      });
      cy.request({ url: '/api/v1/copilot/alerts', headers: auth(token) }).its('body').should('be.an', 'array');
      for (const kind of ['daily', 'weekly', 'monthly']) {
        cy.request({ method: 'POST', url: '/api/v1/copilot/briefings/' + kind, headers: auth(token), body: {} }).then((r) => {
          expect(r.body.created).to.eq(true);
          expect(r.body.briefing.content.kind).to.eq(kind.toUpperCase());
          expect(r.body.briefing.content.sections.length).to.be.greaterThan(3);
        });
      }
      cy.request({ method: 'POST', url: '/api/v1/copilot/briefings/daily', headers: auth(token), body: {} }).its('body.created').should('eq', false);
      cy.request({ method: 'POST', url: '/api/v1/copilot/briefings/hourly', headers: auth(token), body: {}, failOnStatusCode: false }).its('status').should('eq', 404);
      cy.request({ url: '/api/v1/copilot/briefings', headers: auth(token) }).its('body').should('have.length', 3);
      cy.request({ url: '/api/v1/copilot/briefings/latest', headers: auth(token) }).its('body.MONTHLY.content.kind').should('eq', 'MONTHLY');
      cy.request({ method: 'PUT', url: '/api/v1/copilot/settings', headers: auth(token), body: { briefingDaily: false, copilotAlerts: false } }).its('body.briefings').should('deep.equal', { daily: false, weekly: true, monthly: true, alerts: false });
      cy.request({ url: '/api/v1/copilot/dashboard', failOnStatusCode: false }).its('status').should('eq', 401);
    });
  });

  it('CY-COS-01 Chief of Staff overview, Action Center, recovery and settings over the API', () => {
    const email = 'cy.cos.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Chief Tester' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ url: '/api/v1/chief/overview', headers: auth(token) }).then((o) => {
        expect(o.body.greeting).to.eq('Good morning Chief.');
        for (const k of ['highPriority', 'valueAtRiskCents', 'pointsAtRisk', 'certificatesExpiring', 'newHighValueOffers']) expect(o.body.summary).to.have.property(k);
        expect(o.body.center.map((c: { key: string }) => c.key)).to.deep.eq(['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'ANNUAL']);
        expect(o.body.top.length).to.be.at.most(10);
      });
      cy.request({ url: '/api/v1/chief/actions', headers: auth(token) }).its('body').should('have.length', 5);
      cy.request({ url: '/api/v1/chief/recovery', headers: auth(token) }).its('body.version').should('eq', 'cos-recovery/1');
      cy.request({ url: '/api/v1/chief/briefing', headers: auth(token) }).its('body.greeting').should('eq', 'Good morning Chief.');
      cy.request({ method: 'PUT', url: '/api/v1/copilot/settings', headers: auth(token), body: { chiefOfStaff: true } }).its('body.chief.enabled').should('eq', true);
      cy.request({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth(token), body: { quietMode: true } }).its('body.quietMode').should('eq', true);
      cy.request({ url: '/api/v1/copilot/settings', headers: auth(token) }).its('body.chief').should('deep.equal', { enabled: true, quietMode: true });
      cy.request({ url: '/api/v1/chief/overview', failOnStatusCode: false }).its('status').should('eq', 401);
    });
  });

  it('CY-COS-02 command center, fee review, governance, roadmap, life events and household over the API', () => {
    const email = 'cy.cos2.' + Date.now() + '@e2e.test';
    cy.request('POST', '/api/v1/auth/register', { email, password: 'e2e-password-1', name: 'Chief Two' }).then((reg) => {
      const token = reg.body.accessToken as string;
      cy.request({ url: '/api/v1/chief/command-center', headers: auth(token) }).then((c) => {
        expect(c.body.scores.map((s: { key: string }) => s.key)).to.deep.eq(['HOUSEHOLD', 'LOYALTY', 'PORTFOLIO', 'OFFERS', 'TRAVEL']);
        expect(c.body.outlook.assumptions.length).to.be.greaterThan(0);
      });
      cy.request({ url: '/api/v1/chief/fee-review', headers: auth(token) }).its('body.totals.cards').should('be.a', 'number');
      cy.request({ url: '/api/v1/chief/governance', headers: auth(token) }).its('body.version').should('eq', 'cos-governance/1');
      cy.request({ url: '/api/v1/chief/roadmap?days=90', headers: auth(token) }).its('body.phases').should('have.length', 3);
      cy.request({ url: '/api/v1/chief/roadmap?days=365', headers: auth(token) }).its('body.phases').should('have.length', 4);
      cy.request({ url: '/api/v1/chief/household', headers: auth(token) }).its('body.version').should('eq', 'cos-household/1');
      cy.request({ method: 'POST', url: '/api/v1/copilot/ask', headers: auth(token), body: { q: 'What should I do over the next 90 days?' } }).its('body.plan.kind').should('eq', 'ROADMAP');
      const start = new Date(Date.now() + 40 * 86_400_000).toISOString();
      cy.request({ method: 'POST', url: '/api/v1/chief/life-events', headers: auth(token), body: { kind: 'FAMILY_VACATION', title: 'Beach week', destination: 'Maui', startsOn: start, travelers: 3, budgetCents: 300000 } }).then((e) => {
        cy.request({ method: 'POST', url: '/api/v1/chief/life-events/' + e.body.id + '/estimate', headers: auth(token), body: {} }).its('body.estimate.version').should('eq', 'life/1');
        cy.request({ method: 'DELETE', url: '/api/v1/chief/life-events/' + e.body.id, headers: auth(token) }).its('status').should('eq', 204);
      });
      cy.request({ method: 'POST', url: '/api/v1/chief/life-events', headers: auth(token), body: { kind: 'NOPE', title: 'x y' }, failOnStatusCode: false }).its('status').should('eq', 400);
      cy.request({ url: '/api/v1/chief/roadmap', failOnStatusCode: false }).its('status').should('eq', 401);
    });
  });
});
