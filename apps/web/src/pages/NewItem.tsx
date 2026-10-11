import { NewForm } from '@household-brain/entries/components/items/NewForm'
import { Link, useSearchParams } from 'wouter'
import { paths } from '@household-brain/entries/lib/paths'

export const NewItem = () => {
  // `?category=` comes from a category's "+": the form starts in that category.
  const category = useSearchParams()[0].get('category')
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">New entry</h1>
        <Link href={paths.home} className="text-orange-700 underline dark:text-orange-400">Cancel</Link>
      </div>
      <NewForm category={category} />
    </section>
  )
}
