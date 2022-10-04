<template>
  <div
    :class="{'meeple-moved': ev.from}"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="one-square">
      <Meeple
        :type="ev.meeple"
        :class="colorCssClass(ev.player)"
      />
    </div>
    <v-icon v-if="ev.from">fas fa-arrow-right</v-icon>
  </div>
</template>

<script>
import { mapGetters } from 'vuex'

import Meeple from '@/components/game/Meeple'

export default {
  components: {
    Meeple
  },

  props: {
    ev: { type: Object, required: true }
  },

  computed: mapGetters({
    tileOn: 'game/tileOn',
    featureOn: 'game/featureOn',
    colorCssClass: 'game/colorCssClass'
  }),

  methods: {
    showFeature (feature) {
      const places = feature.places.map(p => {
        return {
          tile: this.tileOn(p),
          feature: feature.type,
          location: p[2]
        }
      })
      this.$store.dispatch('board/showLayer', {
        layer: 'EmphasizeLayer',
        props: {
          emphasis: {
            type: 'feature',
            places
          }
        }
      })
    },

    onMouseEnter () {
      const { to } = this.ev
      const feature = this.featureOn(to)
      if (feature) {
        this.showFeature(feature)
      } else {
        this.$store.dispatch('board/showLayer', {
          layer: 'EmphasizeLayer',
          props: {
            emphasis: {
              type: 'meeple',
              barn: this.ev.meeple === 'Barn',
              ...this.ev.to
            }
          }
        })
      }
    },

    onMouseLeave () {
      this.$store.dispatch('board/hideLayerDebounced', { layer: 'EmphasizeLayer' })
    }
  }
}
</script>

<style lang="sass" scoped>
.meeple-moved
  display: flex
  width: 60px

.v-icon
  width: 20px
  font-size: 20px
</style>
