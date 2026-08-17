import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FolderPicker from '../../entrypoints/options/components/FolderPicker.vue'
import { normalizeBookmarkTree, type BrowserBookmarkTreeNode } from '../../src/core/bookmarks'
import type { DisplayedFolder } from '../../src/core/types'

function largeFolderTree(folderCount: number) {
  const folders: BrowserBookmarkTreeNode[] = Array.from({ length: folderCount }, (_, index) => ({
    id: `folder-${index}`,
    title: `Folder ${index}`,
    children: [
      {
        id: `bookmark-${index}`,
        title: `Bookmark ${index}`,
        url: `https://example-${index}.invalid/`,
      },
    ],
  }))
  return normalizeBookmarkTree([
    {
      id: 'root',
      title: '',
      children: [{ id: 'toolbar', title: 'Toolbar', children: folders }],
    },
  ])
}

describe('FolderPicker', () => {
  it('virtualizes 1,000 folders while preserving search, selection, and mixed states', async () => {
    const tree = largeFolderTree(1_000)
    const wrapper = mount(FolderPicker, {
      props: {
        tree,
        selections: [],
      },
    })

    expect(wrapper.text()).toContain('1001 个文件夹')
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(15)

    await wrapper.get('input[type="search"]').setValue('Folder 999')
    await flushPromises()
    expect(wrapper.text()).toContain('2 个文件夹')
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(2)

    const childCheckbox = wrapper.get('button[aria-label="选择 Toolbar / Folder 999"]')
    await childCheckbox.trigger('click')
    const emitted = wrapper.emitted<DisplayedFolder[]>('update:selections')
    expect(emitted?.at(-1)?.[0]).toEqual([{ folderId: 'folder-999', scope: 'subtree', order: 0 }])

    await wrapper.setProps({
      selections: [{ folderId: 'folder-999', scope: 'subtree', order: 0 }],
    })
    await wrapper.get('input[type="search"]').setValue('')
    await flushPromises()
    expect(wrapper.get('button[aria-label="选择 Toolbar"]').attributes('aria-checked')).toBe(
      'mixed',
    )

    await wrapper.setProps({
      selections: [{ folderId: 'toolbar', scope: 'subtree', order: 0 }],
    })
    await wrapper.get('input[type="search"]').setValue('Folder 999')
    await flushPromises()
    expect(
      wrapper.get('button[aria-label="选择 Toolbar / Folder 999"]').attributes('disabled'),
    ).toBeDefined()
  })
})
