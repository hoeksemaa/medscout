import countriesData from "@/data/countries.json";
import type { CountriesData, Country, Region } from "./types";

const data = countriesData as CountriesData;

export function getRegions(): Record<string, Region> {
  return data.regions;
}

export function getCountries(): Country[] {
  return data.countries;
}

export function getCountriesByRegion(regionKey: string): Country[] {
  return data.countries.filter((c) => c.region === regionKey);
}

export function getRegionName(regionKey: string): string | undefined {
  return data.regions[regionKey]?.name;
}

export function formatGeography(
  region?: string,
  countries?: string[]
): string | null {
  if (countries && countries.length > 0) {
    const names = countries
      .map((code) => data.countries.find((c) => c.alpha3 === code)?.name)
      .filter(Boolean);
    return names.join(", ");
  }
  if (region) {
    return data.regions[region]?.name ?? region;
  }
  return null;
}
