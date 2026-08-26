/**
 * County codes to names.
 *
 * The datasets carry the two-letter code the ministry publishes ("SB"), which
 * is what the data contract stores. The interface says "Sibiu", because that
 * is the word a parent would use.
 */
export const COUNTY_NAMES: Readonly<Record<string, string>> = {
  AB: 'Alba',
  AR: 'Arad',
  AG: 'Argeș',
  BC: 'Bacău',
  BH: 'Bihor',
  BN: 'Bistrița-Năsăud',
  BT: 'Botoșani',
  BV: 'Brașov',
  BR: 'Brăila',
  B: 'București',
  BZ: 'Buzău',
  CS: 'Caraș-Severin',
  CL: 'Călărași',
  CJ: 'Cluj',
  CT: 'Constanța',
  CV: 'Covasna',
  DB: 'Dâmbovița',
  DJ: 'Dolj',
  GL: 'Galați',
  GR: 'Giurgiu',
  GJ: 'Gorj',
  HR: 'Harghita',
  HD: 'Hunedoara',
  IL: 'Ialomița',
  IS: 'Iași',
  IF: 'Ilfov',
  MM: 'Maramureș',
  MH: 'Mehedinți',
  MS: 'Mureș',
  NT: 'Neamț',
  OT: 'Olt',
  PH: 'Prahova',
  SM: 'Satu Mare',
  SJ: 'Sălaj',
  SB: 'Sibiu',
  SV: 'Suceava',
  TR: 'Teleorman',
  TM: 'Timiș',
  TL: 'Tulcea',
  VS: 'Vaslui',
  VL: 'Vâlcea',
  VN: 'Vrancea',
};

/** The county's name, or the raw code when it is one we do not know. */
export function countyName(code: string): string {
  return COUNTY_NAMES[code] ?? code;
}
