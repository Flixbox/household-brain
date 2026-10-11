import { Link } from 'wouter'
import { paths } from '@household-brain/entries/lib/paths'
import { LogList } from '@household-brain/entries/components/logs/LogList'

export const Events = () => (
  <section className="space-y-6">
    <div className="flex items-baseline justify-between">
      <h1 className="text-3xl font-bold">Events</h1>
      <Link href={paths.home} className="text-orange-700 underline dark:text-orange-400">Back</Link>
    </div>
    <LogList />
  </section>
)
