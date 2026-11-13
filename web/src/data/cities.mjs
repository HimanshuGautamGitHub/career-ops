// Curated city typeahead suggestions for the location filter (AGEN-254 Gap 4).
//
// The location field is free-text, which is ambiguous for cities that exist in
// more than one country ("Hyderabad" → India or Pakistan? "Birmingham" → UK or
// USA?). Each entry is a disambiguated "City, Country" label; the typeahead
// surfaces both variants so the user picks the one they mean, and the picked
// label (country included) becomes the location chip the scanner matches on.
//
// This is a STARTER list, not an authority — it leans on the world's larger tech
// hubs plus the common collision cases. The field stays free-text, so a city
// absent here is still typeable. Users extend it by editing this file (system
// layer; never personalization). Kept as plain JS (.mjs) so the web `node --test`
// suite can load it without a TypeScript runner, mirroring clean-chips.mjs.

/** @type {readonly string[]} */
export const CITY_SUGGESTIONS = [
  // ── Ambiguous collisions: the same city name across countries ──
  "Hyderabad, India",
  "Hyderabad, Pakistan",
  "Birmingham, United Kingdom",
  "Birmingham, United States",
  "Cambridge, United Kingdom",
  "Cambridge, United States",
  "London, United Kingdom",
  "London, Canada",
  "Richmond, United States",
  "Richmond, Canada",
  "Hamilton, Canada",
  "Hamilton, New Zealand",
  "Córdoba, Spain",
  "Córdoba, Argentina",
  "Santiago, Chile",
  "Santiago, Spain",
  "Tripoli, Libya",
  "Tripoli, Lebanon",
  "Victoria, Canada",
  "Victoria, Australia",
  "Perth, Australia",
  "Perth, United Kingdom",
  "Vancouver, Canada",
  "Vancouver, United States",
  "Columbus, United States",
  "San José, Costa Rica",
  "San Jose, United States",
  // ── Major global tech hubs (unambiguous but common) ──
  "Amsterdam, Netherlands",
  "Austin, United States",
  "Bangalore, India",
  "Barcelona, Spain",
  "Beijing, China",
  "Berlin, Germany",
  "Boston, United States",
  "Chennai, India",
  "Chicago, United States",
  "Copenhagen, Denmark",
  "Dubai, United Arab Emirates",
  "Dublin, Ireland",
  "Frankfurt, Germany",
  "Gurgaon, India",
  "Helsinki, Finland",
  "Hong Kong, China",
  "Istanbul, Turkey",
  "Jakarta, Indonesia",
  "Lisbon, Portugal",
  "Los Angeles, United States",
  "Madrid, Spain",
  "Melbourne, Australia",
  "Mexico City, Mexico",
  "Milan, Italy",
  "Mumbai, India",
  "Munich, Germany",
  "New York, United States",
  "Noida, India",
  "Oslo, Norway",
  "Paris, France",
  "Prague, Czech Republic",
  "Pune, India",
  "Seattle, United States",
  "Seoul, South Korea",
  "Shanghai, China",
  "Singapore, Singapore",
  "Stockholm, Sweden",
  "Sydney, Australia",
  "São Paulo, Brazil",
  "Tel Aviv, Israel",
  "Tokyo, Japan",
  "Toronto, Canada",
  "Warsaw, Poland",
  "Washington, United States",
  "Zurich, Switzerland",
];
