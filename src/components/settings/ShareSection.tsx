/** Owner only: how to share the calendar. Done once in Google Calendar, so the app needs no sharing permission. */
export function ShareSection() {
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Share with your household</h2>
      <p>Share the calendar once in Google Calendar, then the other person signs in here and connects:</p>
      <ol className="list-decimal space-y-1 pl-6">
        <li>
          Open
          {' '}
          <a className="text-orange-700 underline dark:text-orange-400" href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">Google Calendar settings</a>
          {' '}
          and choose
          {' '}
          <strong>Household Brain</strong>
          .
        </li>
        <li>
          Under
          {' '}
          <strong>Share with specific people</strong>
          , add their Google account with
          {' '}
          <strong>Make changes to events</strong>
          .
        </li>
        <li>Add their user id to the allowlist; the app shows it to them after they sign in.</li>
      </ol>
    </div>
  )
}
