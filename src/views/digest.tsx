import type { NightDigest } from '../digest/types.js';

export function DigestPage({ digest }: { digest: NightDigest }) {
  const rows = [...digest.rows].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);

  return (
    <>
      <p><a href="/">back to board</a></p>
      <h1>digest · {digest.night}</h1>
      <p class={digest.badLines > 0 ? 'warn' : 'mute'}>bad lines: {digest.badLines}</p>
      {rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">job</th>
              <th scope="col">owner</th>
              <th scope="col">runs</th>
              <th scope="col">retries</th>
              <th scope="col">last status</th>
              <th scope="col">last error</th>
              <th scope="col">firstAt</th>
              <th scope="col">lastAt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                <th scope="row">{row.job}</th>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td class={row.retries >= 3 ? 'warn' : undefined}>
                  {row.retries}{row.retries >= 3 ? ' · high retries' : ''}
                </td>
                <td class={row.hasFailure ? 'warn' : undefined}>
                  {row.lastStatus}{row.hasFailure ? ' · failure recorded' : ''}
                </td>
                <td>{row.lastError ?? '—'}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
