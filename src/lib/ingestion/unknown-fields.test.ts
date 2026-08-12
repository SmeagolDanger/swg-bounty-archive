import { describe, expect, it } from "vitest";
import { findUnknownFields } from "./unknown-fields";

describe("unknown upstream field detection", () => {
  it("reports new nested fields without dropping them", () => {
    const payload = { id:"X",period:"CURRENT",subject:"player",valueType:"RAW",totalScore:1,periodStartTime:1,periodEndTime:2,fetchedAt:"2026-01-01T00:00:00Z",entries:[{rank:1,participantId:"1",name:"A",score:1,scoreRaw:"1",guildAbbreviation:null,faction:null,planet:null,cityName:null,newMetadata:"preserved"}] };
    expect(findUnknownFields("leaderboard",payload)).toContain("$.entries[0].newMetadata");
  });

  it("does not treat an empty known array as a schema change", () => {
    const payload = { id:"X",period:"CURRENT",subject:"player",valueType:"RAW",totalScore:0,periodStartTime:1,periodEndTime:2,fetchedAt:"2026-01-01T00:00:00Z",entries:[] };
    expect(findUnknownFields("leaderboard",payload)).toEqual([]);
  });
});
