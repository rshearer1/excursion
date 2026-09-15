import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { inflateAls, locatorKind, parseAls } from "./ableton";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049">
<LiveSet>
  <Tracks>
    <MidiTrack Id="8">
      <Name><EffectiveName Value="Drums" /></Name>
      <DeviceChain><MainSequencer><ClipTimeable><ArrangerAutomation><Events>
        <MidiClip Id="0" Time="8">
          <CurrentStart Value="8" /><CurrentEnd Value="16" />
          <LoopStart Value="0" /><LoopEnd Value="4" /><LoopOn Value="true" />
          <Notes><KeyTracks>
            <KeyTrack Id="0"><Notes>
              <MidiNoteEvent Time="0" Duration="0.25" Velocity="100" IsEnabled="true" />
              <MidiNoteEvent Time="2" Duration="0.25" Velocity="100" IsEnabled="false" />
            </Notes><MidiKey Value="36" /></KeyTrack>
            <KeyTrack Id="1"><Notes>
              <MidiNoteEvent Time="1" Duration="0.25" Velocity="100" IsEnabled="true" />
            </Notes><MidiKey Value="38" /></KeyTrack>
          </KeyTracks></Notes>
        </MidiClip>
      </Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain>
    </MidiTrack>
    <MidiTrack Id="9">
      <Name><EffectiveName Value="Clap" /></Name>
      <DeviceChain><MainSequencer><ClipTimeable><ArrangerAutomation><Events>
        <MidiClip Id="1" Time="0">
          <CurrentStart Value="0" /><CurrentEnd Value="4" />
          <LoopStart Value="0" /><LoopEnd Value="4" /><LoopOn Value="false" />
          <Notes><KeyTracks>
            <KeyTrack Id="0"><Notes><MidiNoteEvent Time="3" Duration="0.5" Velocity="90" IsEnabled="true" /></Notes><MidiKey Value="60" /></KeyTrack>
          </KeyTracks></Notes>
        </MidiClip>
      </Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain>
    </MidiTrack>
  </Tracks>
  <MainTrack><DeviceChain><Mixer><Tempo><Manual Value="120" /></Tempo></Mixer></DeviceChain></MainTrack>
  <Locators><Locators>
    <Locator Id="0"><Time Value="8" /><Name Value="Drop 1" /></Locator>
    <Locator Id="1"><Time Value="32" /><Name Value="Breakdown" /></Locator>
  </Locators></Locators>
</LiveSet>
</Ableton>`;

describe("parseAls", () => {
  const p = parseAls(XML);
  it("reads the tempo and the locators as seconds", () => {
    expect(p.bpm).toBe(120);
    expect(p.locators).toEqual([
      { t: 4, name: "Drop 1", kind: "drop" },
      { t: 16, name: "Breakdown", kind: "break" },
    ]);
  });
  it("unrolls a looped clip and skips disabled notes", () => {
    // clip at beat 8, 8 beats long, 4-beat loop: kick at loop beat 0 -> beats 8 and 12 -> 4 s, 6 s
    expect(p.kicks).toEqual([4, 6]);
    expect(p.snares).toEqual([1.5, 4.5, 6.5]); // clap track by name at beat 3, plus key 38 at loop beat 1
  });
  it("names the tracks", () => {
    expect(p.tracks).toEqual(["Drums", "Clap"]);
  });
});

describe("inflateAls", () => {
  it("inflates a gzipped project", async () => {
    const gz = gzipSync(Buffer.from(XML));
    const xml = await inflateAls(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength));
    expect(parseAls(xml).bpm).toBe(120);
  });
  it("classifies locator names", () => {
    expect(locatorKind("Chorus")).toBe("drop");
    expect(locatorKind("Verse 2")).toBe("section");
  });
});
