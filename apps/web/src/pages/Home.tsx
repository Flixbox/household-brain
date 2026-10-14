import { Entries } from '@household-brain/entries/components/items/Entries'
import { HouseholdMissing } from '@household-brain/entries/components/HouseholdMissing'
import { Greeting } from '@household-brain/shell/components/Greeting'

export const Home = () => (
  <section className="space-y-6">
    {/* The top bar shows the app's name; the page still needs its own heading. */}
    <h1 className="sr-only">Entries</h1>
    <Greeting />
    <HouseholdMissing />
    <Entries />
  </section>
)
