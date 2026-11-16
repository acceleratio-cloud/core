import { parseKev } from '../kev.service';

describe('parseKev', () => {
  it('keeps the CVE ids of the catalogue', () => {
    expect(
      parseKev({
        vulnerabilities: [
          { cveID: 'CVE-2021-44228' },
          { cveID: 'not-a-cve' },
          { cveID: 42 },
          null,
        ],
      }),
    ).toEqual(new Set(['CVE-2021-44228']));
  });

  it('reads nothing from anything else', () => {
    expect(parseKev(null).size).toBe(0);
    expect(parseKev({ vulnerabilities: 'x' }).size).toBe(0);
  });
});
