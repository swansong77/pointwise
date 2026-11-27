/**
 * Names the query engine recognises that are not in the user's own data (pure): airlines, hotel brands, points programs, issuers,
 * household relations and destinations. Small, general-knowledge lists; the user's own cards, merchants and members come from the database.
 */
export interface NamedEntity {
  name: string;
  /** what else people call it (lower case, matched as whole words) */
  aliases: string[];
}

export const AIRLINES: NamedEntity[] = [
  { name: 'United', aliases: ['united airlines', 'united air', 'ua', 'mileageplus', 'mileage plus'] },
  { name: 'Delta', aliases: ['delta airlines', 'delta air lines', 'skymiles', 'sky miles'] },
  { name: 'American Airlines', aliases: ['american airlines', 'aadvantage', 'a advantage'] },
  { name: 'Southwest', aliases: ['southwest airlines', 'rapid rewards'] },
  { name: 'JetBlue', aliases: ['jet blue', 'trueblue', 'true blue'] },
  { name: 'Alaska', aliases: ['alaska airlines', 'mileage plan'] },
  { name: 'Hawaiian', aliases: ['hawaiian airlines', 'hawaiianmiles'] },
  { name: 'Air Canada', aliases: ['aeroplan'] },
  { name: 'British Airways', aliases: ['avios', 'executive club'] },
  { name: 'Lufthansa', aliases: ['miles and more', 'miles & more'] },
  { name: 'Air France', aliases: ['flying blue', 'klm'] },
  { name: 'Singapore Airlines', aliases: ['krisflyer', 'kris flyer', 'singapore air'] },
  { name: 'Emirates', aliases: ['skywards'] },
  { name: 'Qatar Airways', aliases: ['qatar', 'privilege club'] },
  { name: 'Turkish Airlines', aliases: ['turkish', 'miles and smiles'] },
  { name: 'ANA', aliases: ['all nippon', 'all nippon airways'] },
  { name: 'Japan Airlines', aliases: ['jal'] },
  { name: 'Korean Air', aliases: ['skypass'] },
  { name: 'Cathay Pacific', aliases: ['cathay', 'asia miles'] },
  { name: 'Qantas', aliases: [] },
  { name: 'Virgin Atlantic', aliases: ['flying club'] },
  { name: 'Frontier', aliases: ['frontier airlines'] },
  { name: 'Spirit', aliases: ['spirit airlines'] },
  { name: 'Etihad', aliases: ['etihad guest'] },
];

export const HOTELS: NamedEntity[] = [
  { name: 'Hilton', aliases: ['hilton honors', 'hampton', 'doubletree', 'waldorf', 'conrad'] },
  { name: 'Marriott', aliases: ['bonvoy', 'marriott bonvoy', 'sheraton', 'westin', 'ritz carlton', 'ritz-carlton', 'courtyard'] },
  { name: 'Hyatt', aliases: ['world of hyatt', 'grand hyatt', 'park hyatt', 'hyatt regency', 'andaz'] },
  { name: 'IHG', aliases: ['ihg one rewards', 'holiday inn', 'intercontinental', 'crowne plaza', 'kimpton'] },
  { name: 'Wyndham', aliases: ['wyndham rewards'] },
  { name: 'Choice Hotels', aliases: ['choice privileges', 'comfort inn'] },
  { name: 'Accor', aliases: ['all accor', 'sofitel', 'fairmont'] },
  { name: 'Best Western', aliases: ['best western rewards'] },
  { name: 'Radisson', aliases: ['radisson rewards'] },
];

/** Bank points currencies, by what people call them. */
export const BANK_PROGRAMS: NamedEntity[] = [
  { name: 'Chase Ultimate Rewards', aliases: ['ultimate rewards', 'chase points', 'ur points', 'ur'] },
  { name: 'American Express Membership Rewards', aliases: ['membership rewards', 'amex points', 'mr points', 'mr'] },
  { name: 'Citi ThankYou', aliases: ['thankyou points', 'thank you points', 'typ'] },
  { name: 'Capital One Miles', aliases: ['capital one points', 'venture miles'] },
  { name: 'Bilt Points', aliases: ['bilt'] },
];

export const ISSUERS: NamedEntity[] = [
  { name: 'American Express', aliases: ['american express', 'amex'] },
  { name: 'Chase', aliases: ['chase'] },
  { name: 'Citi', aliases: ['citi', 'citibank'] },
  { name: 'Capital One', aliases: ['capital one', 'cap one', 'capone'] },
  { name: 'Bank of America', aliases: ['bank of america', 'bofa', 'boa'] },
  { name: 'Wells Fargo', aliases: ['wells fargo'] },
  { name: 'Discover', aliases: ['discover'] },
  { name: 'Barclays', aliases: ['barclays'] },
  { name: 'US Bank', aliases: ['us bank', 'u s bank'] },
];

export type Relationship = 'SPOUSE' | 'PARTNER' | 'CHILD' | 'PARENT' | 'OTHER';

/** "my son", "my wife", "dad": which household relationship a word points to. */
export const RELATION_WORDS: Record<string, Relationship> = {
  son: 'CHILD',
  daughter: 'CHILD',
  kid: 'CHILD',
  kids: 'CHILD',
  child: 'CHILD',
  children: 'CHILD',
  spouse: 'SPOUSE',
  wife: 'SPOUSE',
  husband: 'SPOUSE',
  partner: 'PARTNER',
  mom: 'PARENT',
  mother: 'PARENT',
  dad: 'PARENT',
  father: 'PARENT',
  parent: 'PARENT',
  parents: 'PARENT',
};

export const DESTINATIONS: string[] = [
  'New York', 'NYC', 'Los Angeles', 'San Francisco', 'San Diego', 'Seattle', 'Chicago', 'Boston', 'Washington', 'Miami', 'Orlando', 'Atlanta',
  'Dallas', 'Houston', 'Denver', 'Phoenix', 'Las Vegas', 'Nashville', 'New Orleans', 'Austin', 'Portland', 'Salt Lake City', 'Honolulu', 'Hawaii',
  'Maui', 'Anchorage', 'Alaska', 'Cancun', 'Mexico City', 'Toronto', 'Vancouver', 'Montreal', 'London', 'Paris', 'Rome', 'Madrid', 'Barcelona',
  'Lisbon', 'Amsterdam', 'Frankfurt', 'Munich', 'Zurich', 'Vienna', 'Prague', 'Athens', 'Istanbul', 'Dubai', 'Doha', 'Tel Aviv', 'Cairo', 'Cape Town',
  'Nairobi', 'Delhi', 'Mumbai', 'Bangkok', 'Singapore', 'Hong Kong', 'Taipei', 'Seoul', 'Tokyo', 'Osaka', 'Kyoto', 'Beijing', 'Shanghai', 'Manila',
  'Bali', 'Sydney', 'Melbourne', 'Auckland', 'Fiji', 'Tahiti', 'Bora Bora', 'Costa Rica', 'Puerto Rico', 'Bahamas', 'Jamaica', 'Aruba', 'Bermuda',
  'Lima', 'Bogota', 'Buenos Aires', 'Santiago', 'Rio de Janeiro', 'Sao Paulo', 'Iceland', 'Ireland', 'Dublin', 'Edinburgh', 'Italy', 'France', 'Japan',
  'Korea', 'Thailand', 'Greece', 'Spain', 'Portugal', 'Germany', 'Europe', 'Asia', 'Disney World', 'Disneyland', 'Yellowstone', 'Napa',
];

/** words that make a purchase a trip */
export const TRAVEL_WORDS = /\b(stay|staying|stays|night|nights|flight|flights|fly|flying|airfare|book|booking|vacation|trip|travel|traveling|cruise|business class|first class|economy|award|redeem|redemption|resort|getaway|honeymoon|layover)\b/;
