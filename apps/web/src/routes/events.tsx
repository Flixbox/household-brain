import { Link, createFileRoute } from '@tanstack/react-router'
import { LogList } from '@household-brain/entries/components/logs/LogList'

const Events = () => (
  <section className="space-y-6">
    <div className="flex items-baseline justify-between">
      <h1 className="text-3xl font-bold">Events</h1>
      <Link to="/" className="text-orange-700 underline dark:text-orange-400">Back</Link>
    </div>
    <LogList />
  </section>
)

export const Route = createFileRoute('/events')({
  component: Events,
})
