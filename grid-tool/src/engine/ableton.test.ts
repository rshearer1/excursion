import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { automationChannel, inflateAls, locatorKind, parseAls } from "./ableton";

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

const AUTOMATION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049">
<LiveSet>
  <Tracks>
    <AudioTrack Id="10">
      <Name><EffectiveName Value="Bass" /></Name>
      <DeviceChain>
        <AutomationEnvelopes><Envelopes>
          <AutomationEnvelope Id="0">
            <EnvelopeTarget><PointeeId Value="18216" /></EnvelopeTarget>
            <Automation><Events>
              <FloatEvent Id="0" Time="-63072000" Value="200" />
              <FloatEvent Id="1" Time="0" Value="200" />
              <FloatEvent Id="2" Time="8" Value="2000" />
            </Events></Automation>
          </AutomationEnvelope>
          <AutomationEnvelope Id="1">
            <EnvelopeTarget><PointeeId Value="18300" /></EnvelopeTarget>
            <Automation><Events>
              <FloatEvent Id="0" Time="-63072000" Value="0.5" />
            </Events></Automation>
          </AutomationEnvelope>
        </Envelopes></AutomationEnvelopes>
        <DeviceChain><Devices>
          <AutoFilter Id="1">
            <Cutoff>
              <LomId Value="0" />
              <Manual Value="200" />
              <MidiControllerRange><Min Value="20" /><Max Value="20000" /></MidiControllerRange>
              <AutomationTarget Id="18216"><LockEnvelope Value="0" /></AutomationTarget>
            </Cutoff>
            <Resonance>
              <LomId Value="0" />
              <Manual Value="0.5" />
              <AutomationTarget Id="18300"><LockEnvelope Value="0" /></AutomationTarget>
            </Resonance>
          </AutoFilter>
        </Devices></DeviceChain>
      </DeviceChain>
    </AudioTrack>
  </Tracks>
  <MainTrack><DeviceChain><Mixer><Tempo><Manual Value="120" /></Tempo></Mixer></DeviceChain></MainTrack>
</LiveSet>
</Ableton>`;

describe("automation lanes", () => {
  it("reads an envelope as Track/Parameter with events in beats and the parameter's range", () => {
    const p = parseAls(AUTOMATION_XML);
    expect(p.automation.map((a) => a.name)).toEqual(["Bass/Cutoff"]);
    const cutoff = p.automation[0]!;
    expect(cutoff.min).toBe(20);
    expect(cutoff.max).toBe(20000);
    expect(cutoff.events).toEqual([
      { beat: -63072000, value: 200 },
      { beat: 0, value: 200 },
      { beat: 8, value: 2000 },
    ]);
  });

  it("skips an envelope that never changes (only the initial value)", () => {
    const p = parseAls(AUTOMATION_XML);
    expect(p.automation.some((a) => a.name === "Bass/Resonance")).toBe(false);
  });

  it("samples a lane per frame, normalised 0..1 over the events' own span, holding at both ends", () => {
    const lane = { name: "Bass/Cutoff", min: 20, max: 20000, events: [{ beat: -63072000, value: 200 }, { beat: 0, value: 200 }, { beat: 8, value: 2000 }] };
    // 120 BPM, 30 fps: beat 8 is at 4 s = frame 120; beat 4 (2 s, frame 60) is halfway
    const ch = automationChannel(lane, 120, 30, 181);
    expect(ch).toHaveLength(181);
    expect(ch[0]).toBeCloseTo(0, 6);
    expect(ch[60]).toBeCloseTo(0.5, 6);
    expect(ch[120]).toBeCloseTo(1, 6);
    expect(ch[180]).toBeCloseTo(1, 6);
  });

  it("normalises over the parameter's full range when asked", () => {
    const lane = { name: "Bass/Cutoff", min: 20, max: 20000, events: [{ beat: 0, value: 20 }, { beat: 8, value: 10010 }] };
    const ch = automationChannel(lane, 120, 30, 121, { fullRange: true });
    expect(ch[120]).toBeCloseTo(0.5, 3);
  });
});
