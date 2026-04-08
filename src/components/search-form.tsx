"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Search } from "lucide-react";
import type { CountriesData } from "@/lib/types";

interface SearchFormProps {
  countriesData: CountriesData;
  onSearch: (params: {
    procedure: string;
    region?: string;
    countries?: string[];
  }) => void;
  disabled?: boolean;
}

export function SearchForm({
  countriesData,
  onSearch,
  disabled,
}: SearchFormProps) {
  const [procedure, setProcedure] = useState("");
  const [region, setRegion] = useState<string>("");

  const regionOptions = useMemo(() => {
    return Object.entries(countriesData.regions).map(([key, val]) => ({
      key,
      name: val.name,
    }));
  }, [countriesData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!procedure.trim()) return;
    onSearch({
      procedure: procedure.trim(),
      region: region || undefined,
    });
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="procedure">Procedure or Device</Label>
            <Input
              id="procedure"
              placeholder='e.g., "HoLEP", "percutaneous cholangioscopy", "SpyGlass Discover"'
              value={procedure}
              onChange={(e) => setProcedure(e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label>Region (optional)</Label>
            <Select value={region} onValueChange={(val) => setRegion(val ?? "")} disabled={disabled}>
              <SelectTrigger>
                <SelectValue placeholder="Worldwide" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="worldwide">Worldwide</SelectItem>
                {regionOptions.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="submit"
            disabled={disabled || !procedure.trim()}
            className="w-full bg-orange-500 text-white hover:bg-orange-600"
            size="lg"
          >
            <Search className="h-4 w-4 mr-2" />
            {disabled ? "Searching..." : "Find Medical Professionals"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
