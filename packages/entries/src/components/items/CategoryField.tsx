import { type Category, offeredCategory } from '@household-brain/entries/lib/categories'
import { textFieldClass } from '@household-brain/entries/lib/styles'
import { Field, type FormField } from './Field'
import { FieldProblems } from './FieldProblems'

/**
 * The entry's category, one of the household's. It shows the category the household offers for the
 * stored one (`offeredCategory`), and isn't an edit until saved: a category that arrives meanwhile
 * (another device) still replaces it. The browser checks that one is chosen.
 */
export const CategoryField = ({ field, categories }: { field: FormField, categories: Category[] }) => (
  <Field label="Category" required>
    <select required className={textFieldClass} value={offeredCategory(field.state.value, categories)} onChange={event => { field.handleChange(event.target.value) }}>
      <option value="" disabled>Choose…</option>
      {categories.map(category => <option key={category.slug} value={category.slug}>{category.label}</option>)}
    </select>
    <FieldProblems errors={field.state.meta.errors} />
  </Field>
)
