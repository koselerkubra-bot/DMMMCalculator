export const COUNTRY_ALIAS_MAP = {
  "ARG": ["ARGENTINA", "ARGENTINA*", "ARG"],
  "AUS": ["AUSTRALIA", "AUSTRALIA*", "AUS"],
  "BGD": ["BANGLADESH", "BGD"],
  "BEL": ["BELGIUM", "BEL"],
  "BRA": ["BRAZIL", "BRAZIL*", "BRA", "BRASIL"],
  "BGR": ["BULGARIA", "BGR"],
  "CAN": ["CANADA", "CAN"],
  "COL": ["COLOMBIA", "COLUMBIA", "COL"],
  "CHL": ["CHILE", "CHL"],
  "CZE": ["CZECH REPUBLIC", "CZECH", "CZE"],
  "EGY": ["EGYPT", "EGY"],
  "FRA": ["FRANCE", "FRA"],
  "DEU": ["GERMANY", "DEU", "DEUTSCHLAND"],
  "GRC": ["GREECE", "GREECE NEW 2026", "GRC"],
  "HUN": ["HUNGARY", "HUN"],
  "IND": ["INDIA", "INDIA*", "IND"],
  "IDN": ["INDONESIA", "IDN"],
  "IRN": ["IRAN", "IRN"],
  "ITA": ["ITALY", "ITALY*", "ITA"],
  "JPN": ["JAPAN", "JAPAN*", "JPN"],
  "KEN": ["KENYA", "KEN"],
  "MDA": ["MOLDOVA", "MDA"],
  "MEX": ["MEXICO", "MEXICO*", "MEX"],
  "NLD": ["NETHERLANDS", "NLD", "HOLLAND"],
  "PAK": ["PAKISTAN", "PAK"],
  "POL": ["POLAND", "POLAND*", "POL"],
  "ROU": ["ROMANIA", "ROU"],
  "RUS": ["RUSSIA", "RUSSIA SEEDS", "RUS"],
  "SRB": ["SERBIA", "SRB"],
  "ESP": ["SPAIN", "SPAIN*", "ESP"],
  "TUR": ["TURKEY", "TURKEY*", "TURKIYE", "TURKEY SEEDS", "TUR"],
  "UKR": ["UKRAINE", "UKR"],
  "GBR": ["UK", "UK*", "UNITED KINGDOM", "GBR"],
  "USA": ["US", "USA", "US NEW 2026", "UNITED STATES"],
  "VNM": ["VIETNAM", "VIETNAM*", "VNM"],
  "ZAF": ["SOUTH AFRICA", "SA", "ZAF"],
  "ZMB": ["ZAMBIA", "ZMB"]
};

export class AliasResolver {
  static resolve(rawMarket) {
    if (!rawMarket) return { countryId: null, displayCountry: "", isLightHouse: false, raw: "", isValid: false };
    
    const isLightHouse = rawMarket.includes("*");
    let cleaned = rawMarket.replace(/\*/g, "")
                           .replace(/NEW \d{4}/gi, "")
                           .trim()
                           .toUpperCase();

    for (const [canonicalId, aliases] of Object.entries(COUNTRY_ALIAS_MAP)) {
      if (aliases.includes(cleaned) || canonicalId === cleaned) {
        return {
          countryId: canonicalId,
          displayCountry: aliases[0].replace(/\*/g, ""),
          isLightHouse,
          raw: rawMarket,
          isValid: true
        };
      }
    }

    return {
      countryId: null,
      displayCountry: rawMarket,
      isLightHouse,
      raw: rawMarket,
      isValid: false
    };
  }

  static createAssessmentKey(countryId, bu, year = "2025", version = "v2025") {
    return `${countryId}_${bu.toUpperCase()}_${year}_${version}`;
  }
}
